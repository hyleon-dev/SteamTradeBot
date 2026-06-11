const {createLogger, format, transports} = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const filterOnly = (level) => format(
    (info) => info.level === level ? info : false)();

const logger = createLogger({
  // global format
  format: format.combine(
      format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
      format.printf(
          info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
  ),
  transports: [
    // 1. info
    new DailyRotateFile({
      filename: 'logs/info-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'info',
      format: filterOnly('info')
    }),

    // 2. debug, info, warn, error
    new DailyRotateFile({
      filename: 'logs/debug-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'debug'
    }),

    // 3. errors
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: filterOnly('error')
    }),

    // 4. console output
    new transports.Console({
      level: 'debug', // output all levels
      format: format.combine(
          format.colorize(),
          format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
      )
    })
  ]
});

module.exports = logger;