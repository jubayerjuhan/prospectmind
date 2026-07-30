/**
 * VNC <-> WebSocket bridge for Live LinkedIn Login
 *
 * Browsers can only speak WebSocket, not raw VNC/TCP, so this bridges the
 * two: it terminates a WebSocket connection and pipes bytes straight to
 * x11vnc (started by docker-entrypoint.sh, bound to 127.0.0.1:5900 only —
 * unreachable from outside the container by any other path). noVNC's RFB
 * client on the frontend speaks the WebSocket side of this.
 *
 * Mounted on the same http.Server Express listens on (see server.js) via the
 * 'upgrade' event, since Express itself has no concept of WebSocket upgrades.
 * Gated with the same JWT + role check as the regular protect/requireRole
 * middleware — browsers can't set custom headers on `new WebSocket(...)`, so
 * the access token travels as a query param instead of an Authorization
 * header.
 */

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import net from 'net';
import { URL } from 'url';
import User from '../../models/User.js';
import { getStatus as getLiveLoginStatus } from './linkedinLiveLogin.js';

const VNC_PATH = '/api/organization/linkedin-session/live/vnc';
const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;

const wss = new WebSocketServer({ noServer: true });

const rejectUpgrade = (socket, statusLine) => {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
};

export const attachVncBridge = (httpServer) => {
  httpServer.on('upgrade', async (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (pathname !== VNC_PATH) return; // not ours — leave for any other upgrade handler

    try {
      const token = searchParams.get('token');
      if (!token) return rejectUpgrade(socket, '401 Unauthorized');

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user || !['owner', 'admin'].includes(user.role)) {
        return rejectUpgrade(socket, '403 Forbidden');
      }

      if (getLiveLoginStatus().status !== 'running') {
        return rejectUpgrade(socket, '409 Conflict');
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const vncSocket = net.connect(VNC_PORT, VNC_HOST);

        vncSocket.on('data', (chunk) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk);
        });
        ws.on('message', (chunk) => vncSocket.write(chunk));

        const teardown = () => {
          vncSocket.destroy();
          ws.close();
        };
        vncSocket.on('close', teardown);
        vncSocket.on('error', teardown);
        ws.on('close', teardown);
        ws.on('error', teardown);
      });
    } catch (e) {
      console.warn('[vnc-bridge] Upgrade rejected:', e.message);
      rejectUpgrade(socket, '401 Unauthorized');
    }
  });
};
