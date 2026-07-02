export const buildProspectFilter = ({ organizationId, status, priority, search, includeArchived = false }) => {
  const filter = { organization: organizationId };

  if (!includeArchived) {
    filter.isArchived = false;
  }

  if (status) filter.pipelineStatus = status;
  if (priority) filter.outreachPriority = priority;

  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { company: { $regex: search, $options: 'i' } },
    ];
  }

  return filter;
};
