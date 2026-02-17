import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { getStoredUserName, validateUserName } from '../utils/userIdentity';

interface UserNameGuardProps {
  children: ReactNode;
}

export default function UserNameGuard({ children }: UserNameGuardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const userNameValidation = validateUserName(getStoredUserName());

  if (userNameValidation.code === 'ok') {
    return <>{children}</>;
  }

  const moveToSettings = () => {
    navigate('/settings');
  };

  return (
    <Modal
      isOpen={true}
      onClose={moveToSettings}
      onConfirm={moveToSettings}
      title={t('auth.userNameRequiredTitle')}
      message={t('auth.userNameRequiredMessage')}
      type="alert"
      confirmText={t('auth.goToSettings')}
    />
  );
}
