import React from 'react';

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export function Card({ className = '', children }: CardProps) {
  return (
    <div 
      className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className}`}
      data-testid="card"
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  className?: string;
  children: React.ReactNode;
}

export function CardHeader({ className = '', children }: CardHeaderProps) {
  return (
    <div 
      className={`flex flex-col space-y-1.5 p-6 ${className}`}
      data-testid="card-header"
    >
      {children}
    </div>
  );
}

interface CardTitleProps {
  className?: string;
  children: React.ReactNode;
}

export function CardTitle({ className = '', children }: CardTitleProps) {
  return (
    <h3 
      className={`text-2xl font-semibold leading-none tracking-tight ${className}`}
      data-testid="card-title"
    >
      {children}
    </h3>
  );
}

interface CardDescriptionProps {
  className?: string;
  children: React.ReactNode;
}

export function CardDescription({ className = '', children }: CardDescriptionProps) {
  return (
    <p 
      className={`text-sm text-muted-foreground ${className}`}
      data-testid="card-description"
    >
      {children}
    </p>
  );
}

interface CardContentProps {
  className?: string;
  children: React.ReactNode;
}

export function CardContent({ className = '', children }: CardContentProps) {
  return (
    <div 
      className={`p-6 pt-0 ${className}`}
      data-testid="card-content"
    >
      {children}
    </div>
  );
}

interface CardFooterProps {
  className?: string;
  children: React.ReactNode;
}

export function CardFooter({ className = '', children }: CardFooterProps) {
  return (
    <div 
      className={`flex items-center p-6 pt-0 ${className}`}
      data-testid="card-footer"
    >
      {children}
    </div>
  );
}