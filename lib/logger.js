const { join } = require('path');
const { argv } = require('yargs/yargs')(process.argv.slice(2))
  .count('verbose')
  .alias('v', 'verbose');

const VERBOSE_LEVEL = argv.verbose;

const {
  createLogger, format, transports, addColors,
} = require('winston');

const WinstonDailyRotateFile = require('winston-daily-rotate-file');

const {
  printf,
} = format;

const outputFile = join('./logs', 'app-%DATE%.log');

const logFormat = printf(
  (info) => {
    const padding = info.level.length <= 7 ? 7 : 17; // padding differently if it has colour.
    return `[${info.timestamp}] ${info.level.padEnd(padding, ' ')} [${info.label}]: ${info.message}`;
  },
);

addColors({
  debug: 'bold green',
  info: 'bold blue',
  warn: 'bold yellow',
  error: 'bold gray',
});

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};
const level = [
  'error',
  'warn',
  'info',
  'debug',
];

const logger = createLogger({
  // levels: config.npm.levels,
  level: level[VERBOSE_LEVEL],
  levels,
  format: format.combine(
    format((info) => ({ ...info, level: info.level.toUpperCase() }))(),
    format.label({ label: process?.pid.toString() }),
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize({ all: true }),
        format.timestamp({ format: 'HH:mm:ss' }),
        logFormat,
      ),
    }),
    new WinstonDailyRotateFile({
      level: 'debug',
      filename: outputFile,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '10m',
      maxFiles: '14d',
    }),
  ],
  exitOnError: false,

});

module.exports = logger;
