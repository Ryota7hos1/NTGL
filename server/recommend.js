// Supplier recommendation engine.
//
// Ranks a request's quotes by what the site needs right now. Each quote gets three factor
// scores between 0 and 1, and the weights between them shift with how urgent the part is:
//
//   delivery  - a failed part needs the fastest delivery. Otherwise what matters is the margin: how
//               many days before the end of service life (the needed-by date) the part arrives. Any
//               delivery with a margin is as good as any other, unless its margin is drastically
//               smaller than the best other quote's (more than a year less, or a tenth or less)
//   match     - the exact OEM part beats a compatible alternative
//   price     - cheapest total scores highest, relative to the other quotes
//
// The result is explainable: every ranked quote carries its factor scores and plain reasons.

const DAY = 86400000;

// How much each factor counts, by urgency. Each set sums to 1.
const WEIGHTS = {
  failing: { delivery: 0.6, match: 0.2, price: 0.2 },
  due:     { delivery: 0.3, match: 0.4, price: 0.3 },
  planned: { delivery: 0.1, match: 0.45, price: 0.45 },
};

const MATCH_SCORE = { exact: 1, equivalent: 0.2 };

// When an on-time delivery still counts against a quote: far slower than the fastest alternative.
const CUTTING_IT_CLOSE_DAYS = 365;
const CUTTING_IT_CLOSE_RATIO = 10;

// Days between delivery and the needed-by date; negative when it arrives too late.
const marginDays = (delivery, neededBy) => Math.round((Date.parse(neededBy) - Date.parse(delivery)) / DAY);

// An on-time delivery still counts against a quote when it leaves far less margin than the best other quote.
const cuttingItClose = (margin, otherMargins) => {
  if (!otherMargins.length) return false;
  const bestOther = Math.max(...otherMargins);
  return bestOther - margin > CUTTING_IT_CLOSE_DAYS || bestOther >= margin * CUTTING_IT_CLOSE_RATIO;
};

// Work out what the site needs for this part: how urgent it is and the date a replacement must arrive by.
function siteNeed(part, now) {
  if (part.status === 'failed' || part.lifecycle_status === 'failed' || part.status === 'expired') {
    return {
      urgency: 'failing', needed_by: new Date(now).toISOString().slice(0, 10),
      summary: part.status === 'expired' ? 'Part is past its end of life: get a replacement on site as fast as possible.'
        : 'Machine has a failed part: get a replacement on site as fast as possible.',
    };
  }
  if (part.due_reason) {
    const neededBy = part.due_reason === 'previous_service_life'
      ? new Date(now.getTime() + part.days_until_previous_failure * DAY)
      : new Date(part.end_of_life);
    return {
      urgency: 'due', needed_by: neededBy.toISOString().slice(0, 10),
      summary: part.due_reason === 'previous_service_life'
        ? 'Part is nearing the age the last one failed at: delivery must land before then, and an exact match is preferred.'
        : 'Part is near its end of life: delivery must land before then, and an exact match is preferred.',
    };
  }
  return { urgency: 'planned', needed_by: part.end_of_life, summary: 'Planned purchase with time to spare: exact match and price matter most.' };
}

// 1 for the best value in the set, 0 for the worst; everything equal scores 1.
const normalise = (value, values, lowerIsBetter = true) => {
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return 1;
  return lowerIsBetter ? (max - value) / (max - min) : (value - min) / (max - min);
};

const gbp = n => '£' + n.toLocaleString('en-GB');

function recommend(part, quotes, now = new Date()) {
  if (!quotes.length) return { need: siteNeed(part, now), weights: null, ranked: [] };
  const need = siteNeed(part, now);
  const weights = WEIGHTS[need.urgency];
  const leads = quotes.map(q => q.lead_time_days), totals = quotes.map(q => q.total_gbp);
  const fastest = Math.min(...leads), cheapest = Math.min(...totals);

  const scored = quotes.map(q => {
    const speed = normalise(q.lead_time_days, leads);
    const onTime = q.expected_delivery <= need.needed_by;
    const margin = marginDays(q.expected_delivery, need.needed_by);
    const otherMargins = quotes.filter(o => o !== q).map(o => marginDays(o.expected_delivery, need.needed_by));
    const tooClose = onTime && cuttingItClose(margin, otherMargins);
    // Failing: pure speed. Otherwise any margin before end of life scores full marks, unless it is
    // drastically smaller than the others', which scores the same as arriving too late.
    const delivery = need.urgency === 'failing' ? speed : onTime && !tooClose ? 1 : 0;
    const match = MATCH_SCORE[q.match] ?? 0;
    const price = normalise(q.total_gbp, totals);
    const score = weights.delivery * delivery + weights.match * match + weights.price * price;

    const reasons = [];
    if (need.urgency === 'failing') reasons.push(q.lead_time_days === fastest ? `Fastest delivery (${q.lead_time_days} days)` : `Delivery in ${q.lead_time_days} days`);
    else if (!onTime) reasons.push(`Arrives ${q.expected_delivery}, after it is needed (${need.needed_by})`);
    else if (tooClose) reasons.push(`Arrives only ${margin} days before it is needed; others leave up to ${Math.max(...otherMargins)} days`);
    else reasons.push(`Arrives ${margin} days before it is needed (${need.needed_by})`);
    reasons.push(q.match === 'exact' ? 'Exact OEM part' : 'Compatible alternative, not an exact match');
    reasons.push(q.total_gbp === cheapest ? `Lowest price (${gbp(q.total_gbp)})` : `${gbp(q.total_gbp - cheapest)} more than the cheapest`);

    return {
      quote_id: q.id, raw: score, score: Math.round(score * 100), on_time: need.urgency === 'failing' ? null : onTime,
      factors: { delivery: +delivery.toFixed(2), match, price: +price.toFixed(2) }, reasons,
    };
  });

  // Highest score first, on the unrounded score. When delivery and match are equal (exact parts,
  // on time and none cutting it close) the score only differs by price, so the cheaper one wins;
  // exact ties also go to the cheaper quote, then the faster one.
  const quoteOf = id => quotes.find(q => q.id === id);
  scored.sort((a, b) => b.raw - a.raw
    || quoteOf(a.quote_id).total_gbp - quoteOf(b.quote_id).total_gbp
    || quoteOf(a.quote_id).lead_time_days - quoteOf(b.quote_id).lead_time_days);
  scored.forEach((s, i) => { s.rank = i + 1; delete s.raw; });
  return { need, weights, ranked: scored };
}

module.exports = { recommend, siteNeed, WEIGHTS };
