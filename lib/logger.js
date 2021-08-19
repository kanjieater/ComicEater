function log(str, level = 'debug') {
  console.log(`[${level}] ${str}`);
}

module.exports = {
  log,
};
