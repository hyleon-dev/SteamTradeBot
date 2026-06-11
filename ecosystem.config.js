module.exports = {
    apps: [
        {
            name: "SteamTradeBot",
            script: "./index.js",
            instances: 1,
            max_memory_restart: "500M",
            exec_mode: "fork",
            // Logging
            out_file: "/dev/null",
            error_file: "/dev/null",
            watch: false,
            ignore_watch: [
                "./node_modules",
                "./.DS_Store",
                "./package.json",
                "./package-lock.json",
                "./yarn.lock",
                "./logs",
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