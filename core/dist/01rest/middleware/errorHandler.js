export function errorHandler(err, _req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
_next) {
    console.error(err);
    // Don't leak internal error details to the client
    res.status(500).json({ error: "Internal server error" });
}
//# sourceMappingURL=errorHandler.js.map