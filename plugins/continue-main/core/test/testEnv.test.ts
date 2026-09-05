describe("Test environment", () => {
  test("should have XYNAPSE_GLOBAL_DIR env var set to .xynapse-test", () => {
    expect(process.env.XYNAPSE_GLOBAL_DIR).toBeDefined();
    expect(process.env.XYNAPSE_GLOBAL_DIR)?.toMatch(/\.xynapse-test$/);
  });
});
