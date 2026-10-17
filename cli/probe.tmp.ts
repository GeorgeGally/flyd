import { choiceOf } from "./src/conversation-view/choices.js";
const RANKED = `The five ways are ready:\n\n1. **Keep promises straight.** Big job.\n2. **Jobs end in a result.**\n3. **Corrections become preferences.**\n4. **Recall shows why.**\n5. **Proof learning helps.**\n\nPick the ones you want built, from the page in Flyd or here?`;
console.log(JSON.stringify(choiceOf(RANKED), null, 2));
