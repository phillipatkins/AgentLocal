
const ollama = require('ollama').default;
const MODEL = 'nomic-embed-text';

async function embed(text){
  const res = await ollama.embeddings({model:MODEL,prompt:text});
  return res.embedding;
}

function cosine(a,b){
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){
    dot+=a[i]*b[i];
    na+=a[i]*a[i];
    nb+=b[i]*b[i];
  }
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

module.exports={embed,cosine};
