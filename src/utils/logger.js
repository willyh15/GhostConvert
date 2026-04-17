// src/utils/logger.js
export const log = (...args) => {
  console.log(new Date().toISOString(), '-', ...args);
};
