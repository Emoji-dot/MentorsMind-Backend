-- Migration: Tenant email templates + versions
CREATE TABLE IF NOT EXISTS tenant_email_templates (
  tenant_id VARCHAR(100) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  subject_template TEXT,
  html_template TEXT NOT NULL,
  text_template TEXT NOT NULL,
  variables_schema JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (tenant_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_email_templates_tenant ON tenant_email_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_email_templates_active ON tenant_email_templates(is_active);

CREATE TABLE IF NOT EXISTS tenant_email_template_versions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  subject_template TEXT,
  html_template TEXT NOT NULL,
  text_template TEXT NOT NULL,
  variables_schema JSONB,
  versioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_email_template_versions_tenant ON tenant_email_template_versions(tenant_id, template_name);
