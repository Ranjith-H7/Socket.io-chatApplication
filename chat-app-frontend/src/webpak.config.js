// chat-app-frontend/webpack.config.js
const webpack = require('webpack');

module.exports = {
  resolve: {
    fallback: {
      "http": false,
      "https": false,
      "stream": false,
      "crypto": false,
      "path": false,
      "fs": false,
      "zlib": false,
      "net": false,
      "tls": false,
      "url": false,
      "querystring": false,
      "buffer": false,
      "util": false
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ]
};