import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <img
          src="/img/logo.png"
          alt="Observer Vault Logo"
          style={{ width: '200px', height: '200px', marginBottom: '2rem' }}
        />
        <Heading as="h1" className="hero__title">
          Observer Vault
        </Heading>
        <p className="hero__subtitle">
          Stream video and audio from Signal on your phone to Observer Vault on
          your computer, end-to-end encrypted. Your footage is uploaded remotely
          to your computer immediately and isn't saved to your phone.
        </p>
        <div className={styles.warningBox}>
          <div className={styles.warningIcon}>⚠️</div>
          <div className={styles.warningText}>
            Observer Vault is under active development and is not yet ready to
            be used in the field.
          </div>
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Home"
      description="Signal Desktop fork for community observers"
    >
      <HomepageHeader />
    </Layout>
  );
}
