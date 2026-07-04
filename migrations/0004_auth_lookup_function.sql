-- Login needs to find a user by email BEFORE tenant_id is known (that's
-- exactly what this lookup determines), but RLS on "users" requires
-- app.tenant_id to already be set. Rather than weakening RLS or granting
-- app_runtime a broad bypass, this is one narrow SECURITY DEFINER function
-- that returns only the fields the login flow needs, callable by app_runtime,
-- and nothing else gets a way around tenant isolation.

CREATE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE(id uuid, tenant_id uuid, email text, password_hash text, role user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, email, password_hash, role FROM users WHERE email = p_email;
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO app_runtime;
