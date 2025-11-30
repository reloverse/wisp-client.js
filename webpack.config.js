const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'wisp-client.bundle.js',
    globalObject: 'this',
    library: {
      name: 'WispClient',
      type: 'umd',
      export: 'default',
    },
  },
  mode: 'production'
}