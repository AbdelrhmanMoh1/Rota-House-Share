const errorHandler = (err, req, res, next) => {
  console.error('Server error:', err.stack);
  if (err.code === '23505') return res.status(409).json({ error: 'A record with that value already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
};
module.exports = errorHandler;
