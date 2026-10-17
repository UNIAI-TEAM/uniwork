// Metro resolves an imported image to its asset id, the value <Image source> takes.
declare module "*.png" {
  const asset: number;
  export default asset;
}
