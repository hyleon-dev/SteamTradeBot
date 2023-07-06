module.exports = {
    apps: [
        {
            name: "steamtradebot",
            script: "./index.js",
            instances: 1,
            max_memory_restart: "150M",
            cron_restart: "0 4 * * *",
            // Logging
            out_file: "./out.log",
            error_file: "./error.log",
            merge_logs: true,
            log_date_format: "DD-MM-YY HH:mm:ss Z",
            log_type: "raw",
            watch: true,
            ignore_watch: [
                "./node_modules",
                "./.DS_Store",
                "./package.json",
                "./yarn.lock",
            ],
            // Env Specific Config
            /*env_production: {
                NODE_ENV: "production",
                PORT: 8080,
                exec_mode: "cluster_mode",
            },
            env_development: {
                NODE_ENV: "development",
                PORT: 8080,
                watch: true,
                watch_delay: 3000,
                ignore_watch: [
                    "./node_modules",
                    "./app/views",
                    "./public",
                    "./.DS_Store",
                    "./package.json",
                    "./yarn.lock",
                    "./samples",
                    "./src"
                ],
            },*/
        },
    ],
};