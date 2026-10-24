import { startService } from './local-service.js';
process.on('disconnect', () => process.exit(0));
process.once('message', async (options) => {
    try {
        const { child, ...session } = await startService(options);
        child.once('exit', () => process.exit(1));
        process.send({ session });
    } catch (error) {
        process.send({ error: error.message });
        process.exitCode = 1;
        process.disconnect();
    }
});
