import Stripe from 'stripe'
import { STRIPE_SECRET_KEY } from './env'

if (!STRIPE_SECRET_KEY) {
  throw new Error('[env] Missing required environment variable: STRIPE_SECRET_KEY')
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

export default stripe
