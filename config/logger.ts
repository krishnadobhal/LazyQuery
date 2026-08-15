import winston from "winston";
import client from "prom-client";
import DailyRotateFile from "winston-daily-rotate-file";
import { NextFunction, Request, Response } from "express";
import path from "path"

const logDir = path.join(process.cwd(), "logs")

// Configure logger
const logger = winston.createLogger({
    level: "debug", // Set the minimum log level for logging there are several levels: error, warn, info, http, verbose, debug, silly
    format: winston.format.combine(
        winston.format.colorize(), // Add colors for easier readability
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamps
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
            meta = (meta as any)?.response?.data ? (meta as any).response.data : meta;

            const metaString = Object.keys(meta).length
                ? ` | Meta: ${JSON.stringify(meta)}`
                : '';
            return `${timestamp} [${level}]: ${message}${metaString}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.Console(),
        new DailyRotateFile({
            dirname: logDir,
            filename: 'logfile-%DATE%.json',
            datePattern: 'YYYY-MM-DD', // Rotate daily
            maxFiles: '14d', // Keep logs for 14 days
            format: winston.format.json(), // Ensure logs are in JSON format
        }),
    ],

});


const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route"]
});

const startMonitoring = (req: Request, res: Response, next: NextFunction) => {
    const end = httpRequestDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: req.path }));
    next();
};

export { logger, startMonitoring };
