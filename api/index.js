const { handleApiRequest } = require('./neonHandler.cjs');

module.exports = (req, res) => {
  return handleApiRequest(req, res);
};
