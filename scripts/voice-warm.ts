// Pre-generates every line the demo script makes a robot say, so the stage plays from cache.
import { HOME_VOICES, say } from '../server/voice';

const lines: [string, string][] = [];
const homes = Object.keys(HOME_VOICES);
for (const h of homes) {
  lines.push([h, "I don't know how to do that yet."]);
  lines.push([h, 'load the dishwasher, version 1, from James.']);
  lines.push([h, 'kitchen tidy, version 1, from James. Knife goes high.']);
  lines.push([h, 'Rolled back to version 1.']);
}
for (const h of ['home-1', 'home-2', 'home-3', 'home-4']) lines.push([h, 'kitchen tidy, version 2, from Alex. Knife goes low.']);
for (const h of ['home-5', 'home-6']) {
  lines.push([h, 'Refused. There are kids in this house.']);
  lines.push([h, "I won't do that here. There are kids in this house."]);
}
let chars = 0;
for (const [h, t] of lines) { await say(h, t); chars += t.length; }
console.log(`voice cache warm: ${lines.length} lines across ${homes.length} voices (${chars} characters if all were new)`);
