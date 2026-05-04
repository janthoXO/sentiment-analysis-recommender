const jobs = new Map();
const tickerIndex = new Map();
export async function register(scanJobId, { expected, ticker, figi, name, }, timeoutCallback, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(timeoutCallback, timeoutMs);
        jobs.set(scanJobId, {
            expected,
            received: 0,
            ticker,
            figi,
            name,
            subscribers: [resolve],
            buffer: [],
            timer,
        });
        tickerIndex.set(ticker, scanJobId);
    });
}
export function addSubscriber(scanJobId) {
    return new Promise((resolve, reject) => {
        const job = jobs.get(scanJobId);
        if (job) {
            job.subscribers.push(resolve);
        }
        else {
            reject(new Error("Job not found"));
        }
    });
}
export function receive(scanJobId, result) {
    const job = jobs.get(scanJobId);
    if (!job)
        return false;
    job.buffer.push(result);
    job.received++;
    return job.received >= job.expected;
}
export function finalize(scanJobId) {
    const job = jobs.get(scanJobId);
    if (!job)
        return undefined;
    if (job.timer)
        clearTimeout(job.timer);
    jobs.delete(scanJobId);
    tickerIndex.delete(job.ticker);
    return job;
}
export function getJobIdForTicker(ticker) {
    return tickerIndex.get(ticker);
}
//# sourceMappingURL=inFlight.service.js.map