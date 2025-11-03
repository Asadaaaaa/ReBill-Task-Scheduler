// Library
import { sutando } from "sutando";

class ModelHandler {
    constructor(server) {
        this.server = server;
    }

    async connect() {
        this.server.sendLogs('Connecting to database...');
        try {
            sutando.addConnection({
                client: this.server.env.DB_DIALECT,
                connection: {
                    host: this.server.env.DB_HOST,
                    port: this.server.env.DB_PORT,
                    user: this.server.env.DB_USERNAME,
                    password: this.server.env.DB_PASSWORD,
                    database: this.server.env.DB_DATABASE
                }
            }, 'default');
            this.db = sutando.connection('default');
        } catch (err) {
            this.server.sendLogs(err);
            return -1;
        }

        this.server.sendLogs(`Database "${this.server.env.DB_DATABASE}" Connected`);
        
        return this.db;
    }
}

export default ModelHandler;
