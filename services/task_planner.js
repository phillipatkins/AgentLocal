
const { askOllama } = require("./ollama_client")

async function createPlan(goal){

    const prompt=`
You are an automation planner.

User goal:
"${goal}"

Convert this goal into a detailed JSON execution plan.

Rules:
- Use very detailed steps.
- Each step must contain action + description.
- Allowed actions: goto, search, click_text, fill, scroll, wait.
- Include verification text when possible.

Return JSON:
{
  "steps":[
     {"action":"goto","value":"https://example.com"},
     {"action":"search","value":"example query"},
     {"action":"click_text","value":"button text"}
  ],
  "success_condition":"what confirms completion",
  "required_inputs":[]
}
`
    const res = await askOllama(prompt)

    try{
        return JSON.parse(res)
    }catch{
        return {steps:[],success_condition:"unknown",required_inputs:[]}
    }
}

async function nextStep(goal,history,pageState){

    const prompt=`
User goal:
${goal}

Steps already executed:
${JSON.stringify(history,null,2)}

Current page state:
${JSON.stringify(pageState,null,2)}

What should the next step be?

Return JSON:
{"action":"click_text","value":"example"}
`

    const res = await askOllama(prompt)

    try{
        return JSON.parse(res)
    }catch{
        return null
    }
}

module.exports={createPlan,nextStep}
