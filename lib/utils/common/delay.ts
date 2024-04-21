const delay = async (ms: number) => {
  const result = await new Promise((resolve) => setTimeout(resolve, ms));
};
export default delay;
