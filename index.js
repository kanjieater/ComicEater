require('./lib/logger');
const { parseCommands } = require('./lib/cli');

function main() {
  parseCommands();
}

main();
