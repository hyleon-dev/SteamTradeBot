module.exports = {
    apps: [
        {
            name: "SteamTradeBot",
            script: "./index.js",
            instances: 1,
            max_memory_restart: "500M",
            exec_mode: "fork",
            cron_restart: "0 3 * * *",
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
            ]
        }
    ]
};
