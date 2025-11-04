// Helpers
import { LoggerHelper as sendLogs } from '#helpers';

// Handlers
import { ModelHandler, UsersModel } from '#models';

// Tasks
import { ReportingTask } from '#tasks';

// Library
import * as dotenv from 'dotenv';
import FS from 'fs-extra';
import { CronJob } from 'cron';


class Server {
    constructor() {
        // Server Logger
        this.sendLogs = sendLogs;

        // File System
        this.FS = FS;

        // .env config
        dotenv.config();
        this.env = process.env;

        this.init();
    }

    async init() {
        this.model = new ModelHandler(this);
        const isModelConnected = await this.model.connect();

        if (isModelConnected === -1) {
            this.sendLogs('Connection Failed to the Database');
            return;
        };

        this.run();
    }

    run() {
        // Cron job that runs every day at 5:00 AM
        const dailyMorningJob = new CronJob(
            '0 5 * * *', // Every day at 5:00 AM
            () => {
                this.sendLogs('Running cron job: Daily at 5:00 AM');
                this.dailyMorningTask();
            },
            null, // onComplete
            true, // start immediately
            'Asia/Jakarta' // Jakarta, Indonesia timezone
        );

        this.sendLogs('Cron jobs started successfully');
    }

    dailyMorningTask() {
        // Add your logic here for the task that runs daily at 5:00 AM
        this.sendLogs('Executing daily morning task at 5:00 AM');
        const reportingTask = new ReportingTask(this);
        
        // Get yesterday's date
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        // Get today's date
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        this.sendLogs(`Running reports for yesterday (${yesterdayStr}) and today (${todayStr})`);
        
        // Run for yesterday and today
        reportingTask.run(yesterdayStr, todayStr);
    }
}

new Server();