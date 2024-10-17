select distinct year(created_date)::int as year
  from sample_data.nyc.service_requests
  where agency_name = 'New York City Police Department'
  order by year