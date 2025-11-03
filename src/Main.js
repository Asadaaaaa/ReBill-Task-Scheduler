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

        new ReportingTask(this).run('2025-10-01', '2025-11-03', 6);

        // this.run();
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

    every5SecondsTask() {
        // Add your logic here for the task that runs every 5 seconds
        this.sendLogs('Executing every 5 seconds task');
    }

    everyMinuteTask() {
        // Add your logic here for the task that runs every minute
        this.sendLogs('Executing every minute task');
        new ReportingTask(this).run('2025-10-20', '2025-11-03');
    }

    dailyMorningTask() {
        // Add your logic here for the task that runs daily at 5:00 AM
        this.sendLogs('Executing daily morning task at 5:00 AM');
    }
}

new Server();
