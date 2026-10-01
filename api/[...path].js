const { handleApiRequest } = require('./neonHandler.cjs');

module.exports = async (req, res) => {
  return handleApiRequest(req, res);
};
