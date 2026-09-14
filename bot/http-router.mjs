export function createRequestHandler({ oauth, site, webhook }) {
  return async (req, res) => {
    if (oauth && await oauth(req, res)) return;
    if (site && await site(req, res)) return;
    return webhook(req, res);
  };
}
