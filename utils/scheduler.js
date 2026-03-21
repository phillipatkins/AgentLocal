
const { formatDigest } = require('../services/daily_digest');
const { reflect } = require('../services/reflection');

const quotes = [
"Discipline is choosing between what you want now and what you want most.",
"Small progress each day adds up to big results.",
"Your future is created by what you do today.",
"Action is the foundational key to all success."
];

function randomQuote(){
  return quotes[Math.floor(Math.random()*quotes.length)];
}

function startScheduler(sendMessage, getMessages, getWeather){

  setInterval(async () => {

    const now = new Date();
    const hour = now.getHours();
    const min = now.getMinutes();

    if(hour === 20 && min === 0){
      await sendMessage("Hey Phil — we need to set your Daily Digest. Any reminders or things you need to do tomorrow? Also give me 1 goal you want to achieve.");
    }

    if(hour === 8 && min === 0){
      const weather = await getWeather();
      const msg = formatDigest("default", weather, randomQuote());
      await sendMessage(msg);
    }

    if(hour === 23 && min === 30){
      const messages = await getMessages();
      reflect("default", messages);
    }

  }, 60000);
}

module.exports = { startScheduler };
