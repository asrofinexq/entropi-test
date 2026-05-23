
export async function processPayment(orderId: string, amount: string, customerId: string) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  return {
    chargeId: `ch_mock_${Math.random().toString(36).substring(7)}`,
    status: 'succeeded'
  };
}