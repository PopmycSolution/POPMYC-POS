import { create } from 'zustand';
import type { CartItem, Customer } from '@/types';

type PaymentMethod =
  | 'CASH'
  | 'MOBILE_MONEY'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'CHEQUE'
  | 'CREDIT';

interface PosState {
  cartItems: CartItem[];
  customer: Customer | null;
  paymentMethod: PaymentMethod | null;
  notes: string;
  taxRate: number;
  discountRate: number;
  amountPaid: number;
  changeAmount: number;
  addItem: (item: Omit<CartItem, 'subtotal'>) => void;
  removeItem: (itemId: string) => void;
  updateQty: (itemId: string, quantity: number) => void;
  setCustomer: (customer: Customer | null) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setNotes: (notes: string) => void;
  setTaxRate: (rate: number) => void;
  setDiscountRate: (rate: number) => void;
  setAmountPaid: (amount: number) => void;
  clearCart: () => void;
}

export const usePosStore = create<PosState>((set, get) => ({
  cartItems: [],
  customer: null,
  paymentMethod: null,
  notes: '',
  taxRate: 0,
  discountRate: 0,
  amountPaid: 0,
  changeAmount: 0,

  addItem: (item) => {
    set((state) => {
      const existingIndex = state.cartItems.findIndex(
        (ci) => ci.productId === item.productId
      );

      if (existingIndex !== -1) {
        const updatedItems = [...state.cartItems];
        const existingItem = updatedItems[existingIndex];
        const newQty = existingItem.quantity + item.quantity;
        updatedItems[existingIndex] = {
          ...existingItem,
          quantity: newQty,
          subtotal: existingItem.price * newQty,
        };
        return { cartItems: updatedItems };
      }

      const newItem: CartItem = {
        ...item,
        subtotal: item.price * item.quantity,
      };
      return { cartItems: [...state.cartItems, newItem] };
    });
  },

  removeItem: (itemId) => {
    set((state) => ({
      cartItems: state.cartItems.filter((item) => item.id !== itemId),
    }));
  },

  updateQty: (itemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(itemId);
      return;
    }
    set((state) => ({
      cartItems: state.cartItems.map((item) =>
        item.id === itemId
          ? { ...item, quantity, subtotal: item.price * quantity }
          : item
      ),
    }));
  },

  setCustomer: (customer) => set({ customer }),

  setPaymentMethod: (method) => set({ paymentMethod: method }),

  setNotes: (notes) => set({ notes }),

  setTaxRate: (rate) => set({ taxRate: Math.max(0, rate) }),

  setDiscountRate: (rate) => set({ discountRate: Math.max(0, Math.min(100, rate)) }),

  setAmountPaid: (amount) => {
    set((state) => {
      const subtotal = state.cartItems.reduce((s, i) => s + i.subtotal, 0);
      const taxAmount = subtotal * (state.taxRate / 100);
      const discountAmount = subtotal * (state.discountRate / 100);
      const totalAmount = subtotal + taxAmount - discountAmount;
      const safeAmount = Math.max(0, amount);
      const change = Math.max(0, safeAmount - totalAmount);
      return { amountPaid: safeAmount, changeAmount: change };
    });
  },

  clearCart: () =>
    set({
      cartItems: [],
      customer: null,
      paymentMethod: null,
      notes: '',
      amountPaid: 0,
      changeAmount: 0,
    }),
}));
