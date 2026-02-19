const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ADMIN_USER_ID = process.env.ADMIN_SLACK_USER_ID; // e.g. U012AB3CD
const HELP_CHANNEL_ID = process.env.HELP_CHANNEL_ID;   // e.g. C012AB3CD

const KNOWLEDGE_BASE = `
You are a helpful assistant for cleaning technicians at Clean Affinity. You help answer questions that techs post in the #help Slack channel. Use the following company guidelines to answer questions accurately and helpfully.

=== COMMUNICATION CHANNELS ===
The #help channel is for:
- Parking questions
- Entry/Exit questions
- Issues while in a home
- Schedule issues (running late, need more time, need a break)
- Needing more time at an ELITE, or pushing a job back because they went over
- Equipment issues (tag @quality managers & @growth manager Tyler if unknown)
- Job note clarification
- Asking for a DM (Direct Message) — techs should ALWAYS ask for a DM on the help channel, never initiate a DM directly with a manager

DMs are for:
- Emergencies: accidents, sickness, need to leave early
- Serious coworker issues that leadership should know about
- Reporting inappropriate/offensive client behavior
- Other legitimately private issues

Job Comments are for:
- Finishing a job early or late
- List of rooms/times, job note updates (pets, entry)
- Clock in/out issues

Email (hello@cleanaffinity.com) is for:
- ALL time off requests
- Calling out sick (even mid-day)
- Photo of breakage with client name and what happened
- Payroll questions (paystubs, mileage/parking, training days, etc.)

=== COMMON HELP CHANNEL SCENARIOS ===

TECH IS RUNNING LATE:
- Acknowledge their message and let them know an admin has been notified and will handle it
- Ask what time they expect to arrive if they haven't said
- An admin will follow up with the client — the bot should NOT say it will contact the client

LOCKOUT / CAN'T FIGURE OUT ENTRY:
- Let the tech know you've flagged it and an admin will look into the entry notes in ServiceAdvisor
- Let them know to hang tight while an admin tries to reach the client
- An admin has 30 minutes to gain entry before canceling — the bot should NOT say it will call or text the client
- Note: There is currently a known bug where client entry notes may not show in the SA app — this is being worked on with SA

EXIT QUESTIONS:
- If the client left and there are no lockup instructions, let the tech know an admin will try to reach the client
- In the meantime, advise the tech to use their best judgment — lock the handle, go out the back, etc. It is critical to leave the house secured
- The bot should NOT say it will call or text the client

DM REQUESTS:
- Quickly "like"/thumbs up the request
- Click on the person's name → Message → "Hey ____, how can I help you?"
- If they need to leave due to illness or emergency, have them send an email to hello@cleanaffinity.com
- When the email comes in, tag Growth Manager Tyler
- Reach out to Andrew with any further questions

=== SENSITIVE TOPICS (route to human) ===
The following should NEVER be handled by the bot and must go to a human admin:
- Emergencies (accidents, sickness, needing to leave early)
- Serious coworker issues
- Inappropriate or offensive client behavior reports
- Any personal or private matters
- Payroll disputes or serious payroll issues
- Anything involving legal, medical, or safety concerns
`;

const SENSITIVE_KEYWORDS = [
  'emergency', 'accident', 'sick', 'hurt', 'injured', 'leave early',
  'coworker issue', 'harass', 'offensive', 'inappropriate', 'uncomfortable',
  'private', 'personal', 'assault', 'fired', 'quit', 'serious', 'urgent',
  'dangerous', 'unsafe', 'abusive', 'payroll dispute', 'not paid'
];

function isSensitiveTopic(text) {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some(keyword => lower.includes(keyword));
}

// Only respond in the #help channel
app.message(async ({ message, client, say }) => {
  // Ignore bot messages and messages not in the help channel
  if (message.bot_id) return;
  if (message.channel !== HELP_CHANNEL_ID) return;
  if (!message.text) return;

  const userText = message.text;

  // Check for sensitive topics first
  if (isSensitiveTopic(userText)) {
    await say({
      text: `Hey <@${message.user}>! This sounds like something that needs a personal touch from our admin team. 🙏\n\nPlease *request a DM* here in the channel and someone will reach out to you shortly. Don't initiate a direct message yourself — post here so whoever is available can help you soonest!\n\n<@${ADMIN_USER_ID}> — heads up, a tech may need assistance with a sensitive matter.`,
      thread_ts: message.ts,
    });
    return;
  }

  // Let the tech know we're looking into it
  const thinkingMsg = await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: `Hey <@${message.user}>! Let me look into that for you... 🔍`,
  });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: KNOWLEDGE_BASE,
      messages: [
        {
          role: 'user',
          content: `A cleaning tech posted this in the #help Slack channel: "${userText}"\n\nPlease provide a helpful, friendly, and concise response. You are a bot — you cannot contact clients, make calls, or send texts. Never say you will reach out to a client or take any action yourself. If the situation requires someone to contact a client or take action, tell the tech that an admin has been notified and will handle it, and advise the tech on what they should do in the meantime. Keep it brief and warm. Do not use markdown headers. Use plain text with line breaks if needed.`,
        },
      ],
    });

    const botReply = response.content[0].text;

    // Update the thinking message with the real answer
    await client.chat.update({
      channel: message.channel,
      ts: thinkingMsg.ts,
      text: botReply,
    });

  } catch (err) {
    console.error('Anthropic API error:', err);
    await client.chat.update({
      channel: message.channel,
      ts: thinkingMsg.ts,
      text: `Hey <@${message.user}>, I'm having trouble processing that right now. Please wait for an admin to assist you! <@${ADMIN_USER_ID}>`,
    });
  }
});

(async () => {
  await app.start();
  console.log('⚡️ Clean Affinity Help Bot is running!');
})();
