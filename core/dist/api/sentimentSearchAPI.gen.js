export const getPostInternalTrackUrl = () => {
    return `/internal/track`;
};
export const postInternalTrack = async (postInternalTrackBody, options) => {
    const res = await fetch(getPostInternalTrackUrl(), {
        ...options,
        method: "POST",
        headers: { "Content-Type": "application/json", ...options?.headers },
        body: JSON.stringify(postInternalTrackBody),
    });
    const body = [204, 205, 304].includes(res.status) ? null : await res.text();
    const data = body ? JSON.parse(body) : {};
    return {
        data,
        status: res.status,
        headers: res.headers,
    };
};
//# sourceMappingURL=sentimentSearchAPI.gen.js.map