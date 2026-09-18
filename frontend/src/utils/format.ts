import dayjs from 'dayjs';

export function formatCurrency(
  amount: number,
  currency: string = 'GHS',
  symbol: string = 'GH₵'
): string {
  try {
    const formatted = new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

    return formatted.replace(/GHS|GH₵/, symbol).trim();
  } catch {
    return `${symbol} ${amount.toFixed(2)}`;
  }
}

export function formatDate(
  date: string | Date | number,
  format: string = 'DD/MM/YYYY HH:mm'
): string {
  return dayjs(date).format(format);
}

export function formatPhone(phone: string): string {
  if (!phone) return '';

  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }

  if (cleaned.length === 12 && cleaned.startsWith('233')) {
    return `+233 ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }

  return phone;
}
