// File: netlify/functions/mailchimp.js
import crypto from 'node:crypto';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email = '', name = '', mobile = '', loanType = '', amount = '' } =
      JSON.parse(event.body || '{}');

    if (!email) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no_email' }) };
    }

    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const SERVER = process.env.MAILCHIMP_SERVER_PREFIX; // e.g., 'us12'
    const LIST_ID = process.env.MAILCHIMP_AUDIENCE_ID;
    const JOURNEY_ID = process.env.MAILCHIMP_JOURNEY_ID; // optional
    const STEP_ID = process.env.MAILCHIMP_STEP_ID;       // optional

    if (!API_KEY || !SERVER || !LIST_ID) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing Mailchimp env configuration' }) };
    }

    const authHeader = 'Basic ' + Buffer.from(`any:${API_KEY}`).toString('base64');

    const merge_fields = {
      NAME: name,
      PHONE: mobile,
      LOANTYPE: loanType,
      AMOUNT: String(amount || '')
    };

    const tags = ['apply'].concat(loanType ? [loanType] : []);

    const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    const memberUrl = `https://${SERVER}.api.mailchimp.com/3.0/lists/${LIST_ID}/members/${hash}`;

    const upsertRes = await fetch(memberUrl, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email_address: email,
        status_if_new: 'subscribed',
        status: 'subscribed',
        merge_fields,
        tags
      })
    });

    const upsertJson = await upsertRes.json();
    if (!upsertRes.ok) {
      return {
        statusCode: upsertRes.status,
        body: JSON.stringify({ error: 'Mailchimp upsert failed', details: upsertJson })
      };
    }

    // Optional: trigger a specific Journey step
    let journeyTriggered = false;
    if (JOURNEY_ID && STEP_ID) {
      const journeyUrl = `https://${SERVER}.api.mailchimp.com/3.0/customer-journeys/journeys/${JOURNEY_ID}/steps/${STEP_ID}/actions/trigger`;
      const jRes = await fetch(journeyUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email_address: email })
      });

      const jJson = await jRes.json();
      journeyTriggered = jRes.ok;
      if (!jRes.ok) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true, upserted: true, journeyTriggered, journeyError: jJson
          })
        };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, upserted: true, journeyTriggered }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Unhandled error', details: String(err) }) };
  }
}
