/**
 * PM2 ecosystem config for VPS deployment.
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
    apps: [
        {
            name: "hideandseek-backend",
            script: "./dist/index.js",
            interpreter: "node",
            instances: 1, // Single instance required for in-memory WS manager
            exec_mode: "fork",
            env: {
                NODE_ENV: "production",
                PORT: 3001,
                DB_PATH: "/var/data/hideandseek/hideandseek.db",
                FRONTEND_ORIGIN: "https://yourdomain.com",
            },
            error_file: "/var/log/hideandseek/error.log",
            out_file: "/var/log/hideandseek/out.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            restart_delay: 5000,
            max_restarts: 10,
            watch: false,
        },
    ],
};
