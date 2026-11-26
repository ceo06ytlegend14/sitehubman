import { Redirect } from 'expo-router';

/**
 * There is no product detail route — the live catalog lives on /pricing
 * (subscription/material selection) and the hardware rail on the Orders tab.
 */
export default function ShopProductRedirect() {
  return <Redirect href="/pricing" />;
}
