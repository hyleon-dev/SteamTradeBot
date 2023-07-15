module.exports = {
    apps: [
        {
            name: "SteamTradeBot",
            script: "./index.js",
            instances: 1,
            max_memory_restart: "500M",
            //cron_restart: "0 4 * * *",
            // Logging
            out_file: "./out.log",
            error_file: "./error.log",
            debug_file: "./debug.log",
            merge_logs: true,
            log_date_format: "DD-MM-YY HH:mm:ss",
            log_type: "format",
            watch: false,
            ignore_watch: [
                "./node_modules",
                "./.DS_Store",
                "./package.json",
                "./package-lock.json",
                "./yarn.lock",
                "./error.log",
                "./out.log",
                "./app.log",
                "./*.log",
                "./.git",
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