module.exports = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return '/mock/user/data/path';
      return '/mock/path';
    },
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  BrowserWindow: jest.fn(),
};
