
const { buildWorldState } = require("./world_state");

async function verifyClick(targetLabel){
    const state = buildWorldState();
    return state.targets.some(t=>t.label===targetLabel);
}

async function verifyWindow(name){
    const state = buildWorldState();
    return state.activeWindow.toLowerCase().includes(name.toLowerCase());
}

module.exports = {
    verifyClick,
    verifyWindow
}
