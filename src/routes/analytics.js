function registerAnalyticsRoutes(app, context) {
  const {
    authenticate,
    getActiveUsers,
    getAnalyticsSummary,
    getFileTypes,
    getMostDownloadedFiles,
    getRecentAnalyticsEvents,
    getUploadsByMonth,
    getUploadsByUser,
    requireAnalyticsAccess,
  } = context;

  app.get("/analytics/summary", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getAnalyticsSummary());
  });

  app.get("/analytics/uploads-by-month", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getUploadsByMonth(req.query.months));
  });

  app.get("/analytics/uploads-by-user", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getUploadsByUser(req.query.limit));
  });

  app.get("/analytics/active-users", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getActiveUsers(req.query.days));
  });

  app.get("/analytics/file-types", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getFileTypes());
  });

  app.get("/analytics/downloads-by-file", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getMostDownloadedFiles(req.query.limit));
  });

  app.get("/analytics/recent", authenticate, requireAnalyticsAccess, (req, res) => {
    res.json(getRecentAnalyticsEvents(req.query.limit));
  });
}

module.exports = registerAnalyticsRoutes;
