import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  Bold, Italic, Strikethrough, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, Minus, Braces,
} from 'lucide-react';

/**
 * The newsletter composer.
 *
 * TipTap rather than a contentEditable because the ProseMirror schema IS an
 * allowlist: it can only ever emit the nodes configured below, so pasting from
 * Word or a web page yields clean semantic HTML instead of div-and-font soup
 * that Outlook renders badly. codeBlock is disabled — it has no sensible email
 * rendering. The server sanitizes the result again regardless.
 */

const MERGE_TAGS = [
  { tag: '{{firstName}}', label: 'First name' },
  { tag: '{{lastName}}', label: 'Last name' },
  { tag: '{{fullName}}', label: 'Full name' },
  { tag: '{{company}}', label: 'Company' },
  { tag: '{{email}}', label: 'Email' },
];

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition disabled:opacity-40 ${
        active ? 'bg-indigo-600/30 text-indigo-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * `initialValue` seeds the document once and is deliberately NOT synced back in
 * afterwards. Pushing the parent's value in on every change turns this into a
 * controlled input, and TipTap cannot be one: onUpdate → parent state → prop →
 * setContent races the user's next keystroke, so the editor rewrites its own
 * document mid-edit and the caret jumps. Re-seed by remounting instead — the
 * parent passes key={newsletter._id}.
 */
export default function NewsletterEditor({ initialValue, onChange, disabled }) {
  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: initialValue || '',
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class:
          'min-h-[280px] px-4 py-3 focus:outline-none text-slate-100 text-sm leading-relaxed ' +
          '[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-4 [&_h2]:mb-2 ' +
          '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-3 [&_h3]:mb-1.5 ' +
          '[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 ' +
          '[&_a]:text-indigo-400 [&_a]:underline ' +
          '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-700 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 ' +
          '[&_hr]:border-slate-700 [&_hr]:my-4',
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return <div className="h-[340px] animate-pulse rounded-lg bg-slate-800" />;

  const addLink = () => {
    const previous = editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL', previous);
    if (url === null) return;
    if (!url) return editor.chain().focus().unsetLink().run();
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-700 bg-slate-900/60 px-2 py-1.5">
        <ToolbarButton title="Bold" disabled={disabled} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolbarButton>
        <ToolbarButton title="Italic" disabled={disabled} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolbarButton>
        <ToolbarButton title="Strikethrough" disabled={disabled} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <ToolbarButton title="Heading" disabled={disabled} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></ToolbarButton>
        <ToolbarButton title="Subheading" disabled={disabled} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <ToolbarButton title="Bullet list" disabled={disabled} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolbarButton>
        <ToolbarButton title="Numbered list" disabled={disabled} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton title="Quote" disabled={disabled} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolbarButton>
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <ToolbarButton title="Link" disabled={disabled} active={editor.isActive('link')} onClick={addLink}><Link2 size={15} /></ToolbarButton>
        <ToolbarButton title="Divider" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15} /></ToolbarButton>

        <div className="ml-auto flex items-center gap-1">
          <Braces size={13} className="text-slate-500" />
          <select
            value=""
            disabled={disabled}
            onChange={(e) => {
              if (!e.target.value) return;
              editor.chain().focus().insertContent(e.target.value).run();
              e.target.value = '';
            }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
          >
            <option value="">Insert merge tag…</option>
            {MERGE_TAGS.map((t) => (
              <option key={t.tag} value={t.tag}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
