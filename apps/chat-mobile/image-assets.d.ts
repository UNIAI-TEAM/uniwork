// Metro resolves an imported image to its asset id, the value <Image source> takes.
declare module "*.png" {
  const asset: number;
  export default asset;
}

// A sound the same way: the asset id an expo-audio player takes.
declare module "*.wav" {
  const asset: number;
  export default asset;
}
