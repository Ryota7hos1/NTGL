// Draft replacement procedure (MOP) for a supplier request.
//
// Ordering a part is only half the job: someone still has to replace it safely. This builds the
// outline of that method of procedure from what the request already knows (the part, the machine,
// the site documents and the order), and marks the steps that need an engineer's input. In
// Entangl, this is where procedure generation and review would take over.

const SITE_RULES = 'OPS-RULES rev 7';

function buildProcedure(request, equipment) {
  const { part, order } = request;
  const quote = order?.quote_id ? request.quotes.find(q => q.id === order.quote_id) : null;
  const what = `${part.quantity} × ${part.name}`;
  const docs = [SITE_RULES, ...request.evidence];
  const manual = request.evidence[0] ?? null;

  // Who removes the old parts depends on what the supplier was asked to do.
  const disposalBySupplier = quote ? /disposal/i.test(quote.included) : false;
  const installBySupplier = quote ? /install/i.test(quote.included) : false;

  const steps = [
    { text: `Confirm the work window with the shift lead and check ${equipment.id} redundancy is available before isolating.`, evidence: [SITE_RULES] },
    { text: order ? `Confirm delivery of ${what} from ${order.supplier} (expected ${order.expected_delivery}) and check it matches the order.` : `Confirm ${what} is on site before starting.`, evidence: [] },
    { text: `Isolate ${equipment.name} (${equipment.id}) under lockout/tagout with the two-person rule.`, evidence: [SITE_RULES, ...request.evidence.filter(d => /^SLD/.test(d))] },
    { text: `Remove and replace ${what}${installBySupplier ? `; ${order.supplier} installs under site supervision` : ''}. Record serial numbers.`, evidence: manual ? [manual] : [], needs_input: 'Torque or fitting values must come from the manufacturer data; the outline does not invent them.' },
    { text: disposalBySupplier ? `Hand removed parts to ${order.supplier} for disposal.` : 'Arrange disposal of removed parts; not included in the supplier scope.', evidence: [] },
    { text: `Remove lockout/tagout, restore ${equipment.id} and confirm it returns to its normal state.`, evidence: manual ? [manual] : [] },
    { text: 'Sign off and attach readings and photographs as evidence.', evidence: [] },
  ];

  return {
    id: `MOP-${String(request.id).padStart(3, '0')}`,
    title: `Replace ${what} on ${equipment.id}`,
    status: 'draft',
    request_id: request.id,
    part: { id: part.id, name: part.name, quantity: part.quantity },
    equipment: { id: equipment.id, name: equipment.name, location: equipment.location },
    order: order ? { supplier: order.supplier, expected_delivery: order.expected_delivery, po_reference: order.po_reference } : null,
    documents: [...new Set(docs)],
    steps: steps.map((s, i) => ({ number: i + 1, ...s })),
  };
}

module.exports = { buildProcedure };
